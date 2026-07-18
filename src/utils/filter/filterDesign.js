/**
 * Filter Design engine (narrow band-pass / WDM wizard).
 *
 * Reworked from the old `wdmDesigner.js` to follow a "Filter Design" six-step
 * procedure, whose key property is that it produces
 * **near-final designs immediately**. Three ideas, all absent in
 * the v1 generator, make that happen:
 *
 *   1. EMBEDDED DESIGN.  Steps 1–5 design the filter as if the incident medium
 *      had the SAME refractive index as the substrate ("Match medium = n_sub").
 *      This removes the air/first-layer Fresnel mismatch entirely, so the
 *      multi-cavity Fabry–Pérot prototype is already a clean ~100 % flat-top.
 *      (Global Integer Search: optimized assuming the
 *      refractive index of the incidence medium is equal to that of the
 *      substrate.)  Verified: the embedded LEC25D9 N=4 prototype has peak
 *      T = 1.0000 vs 0.9574 in air — the latter is what the old generator showed.
 *
 *   2. GLOBAL INTEGER SEARCH (step 5).  A discrete optimizer over per-mirror QW
 *      layer counts and per-spacer orders, minimizing the embedded merit
 *      function.  This is what turns the raw prototype into the MF≈0.1 designs
 *      listed in the step-5 candidate table.
 *
 *   3. AR / V-COAT LAST (step 6).  Only at the end is the real incident medium
 *      (air) introduced, matched with a No-AR / 1-layer / 2-layer "V" coating.
 *
 * Structure (substrate → incident, embedded):
 *
 *     sub | M_1  S_1  M_2  S_2  …  S_N  M_{N+1} | inc
 *
 *   N cavities  ⇒  N spacers  +  (N+1) mirrors.
 *   Mirror M_i  = QW stack presenting the spacer-facing material on its faces.
 *                 For an L-spacer the faces are H; mirrors are both-ends-H,
 *                 i.e. odd layer count  H(LH)^a  (a = (g−1)/2).  The
 *                 step-5 example shows odd mirror counts (7, 15, 15).
 *   Spacer S_j  = one layer of the spacer material, order s = s half-waves
 *                 = thickness 2·s·QW.
 *
 * References:
 *   - Worked example LEC25D9-1 (narrow band-pass, λ₀=600 nm, n_H=2.35, n_L=1.46,
 *     n_sub=1.52).
 *   - A. Thelen, "Design of multilayer interference filters," in *Physics of
 *     Thin Films* (1966); equivalent (m,k) prototype family.
 *   - H. A. Macleod, *Thin-Film Optical Filters* 5th ed., §8.2 "Multiple-cavity
 *     narrowband filters."
 *   - Tikhonravov & Trubetskov, *Appl. Opt.* 41, 3176 (2002), §3.
 *
 * This module is pure / Node-safe (no React, no DOM). The UI wrapper resolves
 * catalog materials into index functions and packages results into a Design.
 */

export { constIndex, materialIndexFn, qwThickness } from './filterDesign/indexProviders.js';
export { buildPrototypeLayers, toNDLayers } from './filterDesign/prototypeLayers.js';
export { embeddedT, spectrumT, sampleSpectrum } from './filterDesign/spectrum.js';
export { measureWidth } from './filterDesign/bandwidth.js';
export { recommendCavities } from './filterDesign/cavityRecommendation.js';
export { idealFilterCurve } from './filterDesign/idealCurve.js';
export { oddUp, couplingOrder, coupledMirrors } from './filterDesign/coupledPrototype.js';
export { buildPrototypeFamily } from './filterDesign/prototypeFamily.js';
export { buildFilterTarget } from './filterDesign/filterTarget.js';
export { meritFunctionEmbedded } from './filterDesign/meritFunction.js';
export { globalIntegerSearch } from './filterDesign/globalSearch.js';
export { adjustToIncidentMedium } from './filterDesign/adjustToIncidentMedium.js';
