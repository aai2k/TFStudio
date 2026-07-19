<div align="center">

# TFStudio

**An open-source design, analysis, and optimization environment for optical thin-film coatings.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-1.3.1-informational)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21196149.svg)](https://doi.org/10.5281/zenodo.21196149)

**[Website](https://tfstudio.xyz)** · **[Live demo](https://tfstudio.xyz/demo/)** · **[Documentation](https://docs.tfstudio.xyz)** · **[Download](../../releases)**

</div>
<img width="1514" height="907" alt="Screenshot_400" src="https://github.com/user-attachments/assets/f7e2175a-a80d-47d4-b780-32e8020d4cc2" />


## What is TFStudio?

TFStudio is a professional desktop application for designing and analyzing **optical thin-film coatings** — antireflection coatings, mirrors, beamsplitters, bandpass and edge filters, and more. It combines a rigorous, double-precision optical engine with modern refinement and synthesis algorithms and a full analysis suite, in a docked, multi-window interface.


> ⚠️ **Status:** TFStudio is independently developed software. While the optical engine is validated against reference data (see [Scientific basis](#scientific-basis)), always verify critical designs against your own measurements before committing them to a production deposition run.


## Key features

**Design & evaluation**
- Transfer-matrix method (TMM) for **absorbing and dispersive** media at **oblique incidence**, both **s- and p-polarization**
- Full-system modeling: front coating, substrate (with absorption), and back coating, including incoherent substrate multiple reflections
- Reflectance / transmittance / absorptance spectra, color, integral figures of merit
- Layer editor with simultaneous physical / optical / quarter-wave / full-wave thickness representations

**Optimization & synthesis**
- **Damped least-squares / Levenberg-Marquardt** refinement with an **analytic Jacobian**
- Additional refiners: Newton, Newton-CG, SQP, conjugate-gradient, differential evolution, simulated annealing
- **Needle** optimization and **gradual evolution** synthesis (automatic layer insertion from scratch)
- Structural optimization over the layer count itself
- Flexible merit function: spectral targets, ramps, band averages, worst-case operands, thickness constraints
- Multi-threaded via a Web Worker pool; hot kernels accelerated with **WebAssembly (SIMD)**

**Analysis windows**
- Optical evaluation, admittance diagrams, electric-field profiles, group delay / GDD, ellipsometric parameters, color evaluation, refractive-index profile
- Tolerance & manufacturing analysis: Monte-Carlo error analysis, layer sensitivity, inhomogeneity, roughness/scattering, systematic deviations

**Materials**
- Built-in library generated from the [refractiveindex.info](https://refractiveindex.info) database (CC0)
- Sellmeier / Cauchy / tabulated dispersion; complex index with explicit conventions
- Import of external catalogs and an in-app refractiveindex.info browser

**Manufacturing**
- Deposition / monitoring simulation (broadband and monochromatic optical monitoring)
- Process exporter and optical-coating data interchange (including Zemax OpticStudio coating export/import)

**Platform**
- Cross-platform desktop app (Electron + React, pure JavaScript)
- Built-in help/documentation, English and Russian UI


## Scientific basis

TFStudio implements established thin-film optics, citing primary sources:

- **Transfer-matrix method** — H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.
- **Numerical needle synthesis** — Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996); Tikhonravov et al., *Appl. Opt.* **35**, 5493 (1996)
- **Gradual evolution** — Tikhonravov et al. (2007)

All computations use double precision. The TMM engine agrees with independent reference calculations to within single-digit parts-per-million for validated test cases.

## Installation

### Download (recommended)
Grab the latest installer or portable build from the [**Releases**](../../releases) page.

Want to try it first? Run the **[live web demo](https://tfstudio.xyz/demo/)** — example designs and live spectra, right in the browser, no install.

### Build from source
Requires [Node.js](https://nodejs.org) 18+ and git.

```bash
git clone https://github.com/aai2k/TFStudio.git
cd TFStudio
npm install
# (optional but highly recommended) rebuild the WebAssembly kernel — requires the Emscripten SDK:
npm run build:wasm

npm start          # launch the app
```

`npm run build` checks out the refractiveindex.info database submodule and installs
the docs-site dependencies automatically. The database is large; to pull it upfront
instead of on first build, clone with `--recursive`.

Other useful scripts:

```bash
npm test              # run the test suite
npm run docs:install  # install docs-site deps (needed before docs:dev)
npm run docs:dev      # preview the documentation site
npm run build         # package a distributable (electron-builder)
```


One-click install can be tried via build-release.ps1 script.

User documentation is hosted at **[docs.tfstudio.xyz](https://docs.tfstudio.xyz)**, is built into the app (Help menu), and its source lives in [`docs-site/`](./docs-site).

## Citing TFStudio

If TFStudio contributes to your work, please cite it. Citation metadata is in [`CITATION.cff`](./CITATION.cff); GitHub renders a "Cite this repository" button from it. 

## Contributing

Issues and pull requests are welcome. Because TFStudio is a scientific tool,
contributions to the optical engine are held to a physics-correctness bar (cite
your sources, validate against a reference, add a test). Please read
[**CONTRIBUTING.md**](./CONTRIBUTING.md) before opening a pull request.

By contributing you agree that your contributions are licensed under the project's MIT license.

## License

[MIT](./LICENSE) © 2026 Andrey Achapovsky

## Author

**Andrey Achapovsky** — [ORCID 0009-0005-1497-6279](https://orcid.org/0009-0005-1497-6279)

## Acknowledgements

- Material data derived from the [refractiveindex.info](https://refractiveindex.info) database (CC0, public domain).
- Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Plotly.js](https://plotly.com/javascript/), and [KaTeX](https://katex.org/).
