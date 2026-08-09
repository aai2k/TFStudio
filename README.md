<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/aai2k/TFStudio/main/assets/banner-on-dark.png">
  <img width="320" alt="TFStudio"
       src="https://raw.githubusercontent.com/aai2k/TFStudio/main/assets/banner-on-light.png" />
</picture>

**An open-source design, analysis, and optimization environment for optical thin-film coatings.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Version](https://img.shields.io/badge/version-1.5.0-informational)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)
[![Maintainability](https://qlty.sh/gh/aai2k/projects/TFStudio/maintainability.svg)](https://qlty.sh/gh/aai2k/projects/TFStudio)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21196149.svg)](https://doi.org/10.5281/zenodo.21196149)

**[Website](https://tfstudio.xyz)** · **[Tutorials](https://tfstudio.xyz/blog)** · **[Live demo](https://tfstudio.xyz/demo/)** · **[Documentation](https://docs.tfstudio.xyz)** · **[Download](../../releases)**

**English** · [简体中文](./README.zh-CN.md)

</div>
<img width="1629" height="951" alt="Screenshot_28" src="https://github.com/user-attachments/assets/428314ae-56b6-4d82-9f3f-e214b21083bc" />



## What is TFStudio?

TFStudio is a professional desktop application for designing and analyzing **optical thin-film coatings**: antireflection coatings, mirrors, beamsplitters, bandpass and edge filters, and more. It combines a rigorous, double-precision optical engine with modern refinement and synthesis algorithms and a full analysis suite, in a docked, multi-window interface.


> ⚠️ **Status:** TFStudio is independently developed software. Always verify critical designs against your own calculations and measurements before committing them to a production deposition run.


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

 <img width="1225" height="866" alt="image" src="https://github.com/user-attachments/assets/6fc88e64-7a06-44a3-95bd-352d4c4716ed" />

**Manufacturing**
- Deposition / monitoring simulation (broadband and monochromatic optical monitoring)
- Process exporter and optical-coating data interchange (including Zemax OpticStudio coating export/import)

**Platform**
- Cross-platform desktop app (Electron + React, pure JavaScript)
- Built-in help/documentation, English and Russian UI


## Scientific basis

TFStudio implements established thin-film optics, citing primary sources:

- **Transfer-matrix method:** H. A. Macleod, *Thin-Film Optical Filters*, 5th ed.
- **Numerical needle synthesis:** Sullivan & Dobrowolski, *Appl. Opt.* **35**, 5484 (1996); Tikhonravov et al., *Appl. Opt.* **35**, 5493 (1996)
- **Gradual evolution:** Tikhonravov et al. (2007)

All computations use double precision. The TMM engine agrees with independent reference calculations to within single-digit parts-per-million for validated test cases.

The transfer-matrix engine is published separately as **[tmmcore](https://github.com/aai2k/tmmcore)**, so its accuracy can be checked without installing TFStudio: two commands reproduce agreement with an independently written implementation to 8.6e-14. See its [validation page](https://aai2k.github.io/tmmcore/validation/).

## Installation

### Download (recommended)
Grab the latest build for your platform from the [**Releases**](../../releases) page.

**Windows:** `TFStudio Setup <ver>.exe` installs normally; `TFStudio-<ver>-Portable.exe` is a single executable that needs no installation, for locked-down deposition PCs. Separate Windows 7/8.1 builds are published alongside.

**Linux:** On Debian and Ubuntu, `TFStudio-<ver>-amd64.deb` is the recommended package:

```bash
sudo apt install ./TFStudio-*-amd64.deb
tfstudio
```

Installing as root is what lets the Chromium sandbox stay enabled. The `.deb` is the only Linux package that keeps it on, and it also adds TFStudio to the applications menu.

`TFStudio-<ver>-x86_64.AppImage` is the portable alternative:

```bash
chmod +x TFStudio-*-x86_64.AppImage
./TFStudio-*-x86_64.AppImage
```

AppImages need FUSE 2, which Ubuntu 22.04 and later no longer install by default. Either add it (`sudo apt install libfuse2`), run the AppImage with `--appimage-extract-and-run`, or use the `TFStudio-<ver>-x64.tar.gz` archive, which unpacks and runs with no such dependency.

From the `.tar.gz`, start the app through the bundled launcher rather than the binary:

```bash
tar xzf TFStudio-*-x64.tar.gz
cd TFStudio-*-x64
./tfstudio.sh
```

`tfstudio.sh` works around a Chromium requirement that an unpacked archive cannot satisfy: the sandbox helper has to be owned by root, which an archive extracted as a normal user never is. Running the `tfstudio` binary directly instead aborts on startup with `The SUID sandbox helper binary was found, but is not configured correctly`. The launcher disables the sandbox only when there is no working alternative, so installing the `.deb` remains the more secure option.

Want to try it first? Run the **[live web demo](https://tfstudio.xyz/demo/)** for example designs and live spectra in the browser, with no installation required.

### Build from source
Requires [Node.js](https://nodejs.org) 18+ and git.

```bash
git clone https://github.com/aai2k/TFStudio.git
cd TFStudio
npm install
npm start          # launch the app
```

The WebAssembly transfer-matrix kernel arrives prebuilt with the `tmmcore`
dependency, so no Emscripten toolchain is needed and source builds get the same
performance as the released binaries.

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

### Packaging releases

`build-release.ps1` provisions everything a fresh clone needs and packages the
installers in one step. It asks which optional targets to include; pass the flags
to answer up front.

```powershell
npm run dist                  # Windows 10/11 installer + portable
npm run dist -- -Win7         # ...and the Windows 7/8.1 builds
npm run dist -- -Linux        # Linux .deb + AppImage + tar.gz only
```

The Linux artifacts are produced by `build-release-linux.sh`, which the release
script drives through WSL; it also runs on any Linux host directly. It needs a
distribution with Node.js 18+ and `rsync`, and builds in the Linux filesystem
rather than in place, so a Windows checkout keeps its Windows `node_modules`.
The Windows-driven WSL build skips GUI verification. A direct Linux build launches
the unpacked application under Xvfb as a smoke test, or skips it with a message if
Xvfb is not installed.

Note that the smoke test runs under Xvfb, so it exercises the X11 path only. A
regression that appears solely under native Wayland, such as a window that is
never presented, will pass it. Check a Wayland session by hand before releasing.

macOS builds require a macOS host and are not currently published.

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

**Andrey Achapovsky:** [ORCID 0009-0005-1497-6279](https://orcid.org/0009-0005-1497-6279)

## Acknowledgements

- Material data derived from the [refractiveindex.info](https://refractiveindex.info) database (CC0, public domain).
- Built with [Electron](https://www.electronjs.org/), [React](https://react.dev/), [Plotly.js](https://plotly.com/javascript/), and [KaTeX](https://katex.org/).
