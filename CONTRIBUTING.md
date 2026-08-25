# Contributing to TFStudio

Thank you for your interest in TFStudio! It is a scientific engineering tool for
designing optical thin-film coatings, so contributions are welcome. They are
held to a **physics-correctness bar** as much as a code-quality one. This guide
explains how to get set up and what a mergeable contribution looks like.

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE).

---

## Ways to contribute

- **Report a bug:** Open an issue with steps to reproduce, the design/inputs
  involved, what you expected, and what happened. For numerical issues, include
  the exact numbers and, if possible, a reference value (OptiLayer/TFCalc/Macleod).
- **Suggest a feature:** Open an issue describing the use case first, before
  writing code. For anything touching the optical engine or optimizer, cite the
  method you have in mind (paper + equation).
- **Improve documentation:** The user docs live in [`docs-site/`](./docs-site).
- **Improve a translation:** UI translation fixes and new locales are welcome.
  For a new locale, open an issue first to coordinate terminology, review, and
  ongoing maintenance. The Russian locale is maintained by the author; the
  Chinese locale was contributed by the community.
- **Fix a bug / implement a feature:** Please claim or reference an issue so work
  is not duplicated.

> **Not currently open for outside contribution:** The bundled material library
> is maintained by the author. If you spot a material-data problem, file an issue
> instead of opening a PR.

If you plan a large change, please open an issue to discuss it before investing
significant time.

---

## Development setup

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
# Clone WITH submodules; the refractiveindex.info database is a git submodule
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
| `npm run docs:dev` | Preview the documentation site |
| `npm run build` | Package a distributable (electron-builder) |

The transfer-matrix kernel lives in a separate package,
[tmmcore](https://github.com/aai2k/tmmcore), and its WebAssembly build arrives
prebuilt through `npm install`. No Emscripten toolchain is needed here. Changes
to the kernel itself belong in that repository.

### Project layout (orientation)

| Path | Contents |
|---|---|
| `src/utils/physics/` | Optical engine: TMM, optimizer, synthesis (the scientific core) |
| `src/utils/materials/` | Dispersion models, material database, catalog management |
| `src/utils/workers/` | Web Worker pool for refinement, needle, gradual evolution |
| `src/components/` | React UI (windows, panels, dialogs) |
| `src/constants/locales.js` | All user-facing strings (English, Russian, Chinese) |
| `src/main/` | Electron main process |
| `tests/` | Node-based test suite and numerical validations |
| `docs-site/` | User documentation (Astro Starlight) |

### Tests

TFStudio ships an extensive test suite with **151 test files** in [`tests/`](./tests),
covering the optical engine, optimizer and synthesis, material models, file I/O, and
UI logic, including numerical validations against reference values. Please lean on it:

- Run `npm test` (fast suite) before opening a PR. It must be green.
- `npm run test:all` adds the slower optimizer benchmarks; `npm run test:list` shows
  every test.
- When you fix a bug, add a test that would have caught it. When you change anything
  numerical, add/adjust a test that pins the expected result to a reference value.
- The existing tests are also the best documentation of how a subsystem is expected
  to behave. Read the nearest one before changing engine code.

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
  compared against a trusted source, such as OptiLayer/TFCalc output, a published
  result, or an independent analytic check. Report the comparison in the PR.
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
- The renderer is ES modules; the Electron main process is CommonJS. Keep to the
  convention of the file you are editing.
- **Don't hardcode user-facing text.** UI strings go through the localization
  system (`t.*`, backed by `src/constants/locales.js`); add the English string
  there and leave the other locales to be filled in separately.
- Keep changes focused. Unrelated refactors in the same PR make review harder.
- Do not commit build output, logs, `node_modules`, or personal editor/config files.

---

## Submitting a pull request

1. Fork the repo and create a branch from `main`.
2. Make your change, add/adjust tests, and run `npm test` (all green).
3. Write a clear PR description: **what** changed, **why**, and, for numerical
   changes, the **reference validation** (what you compared against and the
   agreement).
4. Keep the PR reasonably small and self-contained.
5. Be responsive to review feedback; correctness questions may take a round or two.

---

Thanks again. Careful, well-referenced contributions are what keep TFStudio
trustworthy for real coating design.
