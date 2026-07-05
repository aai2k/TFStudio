# Contributing to TFStudio

Thank you for your interest in TFStudio! It is a scientific engineering tool for
designing optical thin-film coatings, so contributions are welcome — but they are
held to a **physics-correctness bar** as much as a code-quality one. This guide
explains how to get set up and what a mergeable contribution looks like.

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE).

---

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce, the design/inputs
  involved, what you expected, and what happened. For numerical issues, include
  the exact numbers and, if possible, a reference value (OptiLayer/TFCalc/Macleod).
- **Suggest a feature** — open an issue describing the use case first, before
  writing code. For anything touching the optical engine or optimizer, cite the
  method you have in mind (paper + equation).
- **Improve documentation** — the user docs live in [`docs-site/`](./docs-site).
- **Fix a bug / implement a feature** — please claim or reference an issue so work
  is not duplicated.

> **Not currently open for outside contribution:** UI translations and the bundled
> material library are maintained by the author. Please don't open PRs for these;
> if you spot a translation error or a material-data problem, file an issue instead.

If you plan a large change, please open an issue to discuss it before investing
significant time.

---

## Development setup

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
# Clone WITH submodules — the refractiveindex.info database is a git submodule
git clone --recursive https://github.com/aai2k/TFStudio.git
cd TFStudio

# If you already cloned without --recursive:
git submodule update --init --recursive

npm install
npm start          # launch the app (Electron)
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm start` | Launch the app |
| `npm run dev` | Launch with dev flags |
| `npm test` | Run the fast test suite (`tests/run-all.mjs`) |
| `npm run test:all` | Full suite including slower benchmarks |
| `npm run seed` | Regenerate the bundled material catalogs |
| `npm run build:wasm` | Rebuild the WebAssembly TMM kernel (needs the [Emscripten SDK](https://emscripten.org)) |
| `npm run docs:dev` | Preview the documentation site |
| `npm run build` | Package a distributable (electron-builder) |

You do **not** need Emscripten for normal development — a prebuilt WASM kernel is
committed, and the engine has a pure-JS fallback. Only rebuild it if you change
`src/wasm/`.

### Project layout (orientation)

| Path | Contents |
|---|---|
| `src/utils/physics/` | Optical engine: TMM, optimizer, synthesis (the scientific core) |
| `src/utils/materials/` | Dispersion models, material database, catalog management |
| `src/utils/workers/` | Web Worker pool for refinement, needle, gradual evolution |
| `src/components/` | React UI (windows, panels, dialogs) |
| `src/constants/locales.js` | All user-facing strings (English + Russian) |
| `src/main/` | Electron main process |
| `tests/` | Node-based test suite and numerical validations |
| `docs-site/` | User documentation (Astro Starlight) |

---

## The scientific-correctness bar

This is what makes TFStudio different from a typical app. Any change to the optical
engine, optimizer, material models, or analysis must respect these rules:

- **No invented physics.** Every formula must come from the literature. **Cite the
  source** (author, book/paper, equation number and page) in a code comment and in
  the PR description. Primary references: Macleod, *Thin-Film Optical Filters* (5th
  ed.); Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996); Tikhonravov et al.,
  *Appl. Opt.* **35**, 5493 (1996) and (2007).
- **Double precision everywhere.** No single-precision shortcuts in numerical code.
- **Explicit conventions.** State units, wavelength convention, angle convention,
  and the sign of the imaginary part of the complex index (k). Do not change an
  existing phase/sign convention without updating every dependent path.
- **Validate against a reference.** New or changed numerical methods must be
  compared against a trusted source — OptiLayer/TFCalc output, a published result,
  or an independent analytic check — and the comparison reported in the PR.
- **Add a test.** Numerical changes need a test in `tests/` that pins the expected
  result (ideally to a reference value with a stated tolerance). `npm test` must
  pass before you open the PR.
- **Numerical stability matters.** Prefer stable matrix formulations; avoid
  catastrophic cancellation; guard against degenerate inputs (grazing incidence,
  zero thickness, absorbing/dispersive edge cases).

A PR that changes a computed result without a reference comparison and a test will
be asked for one before review can continue.

---

## Code style

- Match the style of the surrounding code (naming, structure, comment density).
- The renderer is ES modules; the Electron main process is CommonJS — keep to the
  convention of the file you are editing.
- **Don't hardcode user-facing text.** UI strings go through the localization
  system (`t.*`, backed by `src/constants/locales.js`); add the English string
  there and leave the Russian translation to the maintainer.
- Keep changes focused. Unrelated refactors in the same PR make review harder.
- Do not commit build output, logs, `node_modules`, or personal editor/config files.

---

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your change, add/adjust tests, and run `npm test` (all green).
3. Write a clear PR description: **what** changed, **why**, and — for numerical
   changes — the **reference validation** (what you compared against and the
   agreement).
4. Keep the PR reasonably small and self-contained.
5. Be responsive to review feedback; correctness questions may take a round or two.

---

Thanks again — careful, well-referenced contributions are what keep TFStudio
trustworthy for real coating design.
