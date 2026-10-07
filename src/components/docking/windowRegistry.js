/**
 * Window registry: the single source of truth for dockable tool windows.
 *
 * Adding a tool window used to mean editing five places in DockingLayout.js (the
 * import block, the `ToolContent` if-chain, `TOOL_CONFIGS`, `TOOL_LABELS`, and
 * `HELP_ANCHORS`) plus the Toolbar and locales. Now everything DockingLayout
 * needs lives in ONE entry here; DockingLayout derives its tables from this map.
 *
 * Each entry (all fields optional except as noted):
 *   component  React window component. Omit (or null) for a tool that is NOT a
 *              docked window: a modal/wizard handled elsewhere, or a stub. Such
 *              ids may still carry a title/label/help; ToolContent falls through
 *              to the placeholder for them (unchanged behavior).
 *   title      Tab title (→ TOOL_CONFIGS[id].title). Omit → id is used.
 *   label      Placeholder / description text (→ TOOL_LABELS[id]).
 *   help       Starlight help-site slug (→ helpAnchorFor). Omit → '/index/'.
 *   theme      Pass the `theme` prop to the component (most windows need it).
 *   dialog     Pass the `setInputDialog` prop (editors that prompt for input).
 *   createDesign
 *              Pass the `onCreateDesign` prop: add a ready-made design to the
 *              project explorer and open it. It is absent while no folder is
 *              selected to create one in, so a window can disable the action.
 *   requiresDesign
 *              Do not mount the window while no design is open: it works on
 *              the open design and has nothing of its own to show without one.
 *              Until one is open, the window draws a request to open or create
 *              a design instead of computing from the placeholder.
 *   requiresResolvedMaterials
 *              Do not mount the window while the active design references a
 *              material with no embedded or catalog definition.
 *
 * Props contract preserved exactly from the old ToolContent: every window gets
 * { c, t }; `theme:true` adds `theme`; `dialog:true` adds `setInputDialog`;
 * `createDesign:true` adds `onCreateDesign`.
 */

import { DesignEditor } from '../windows/design/designEditor/DesignEditor.js';
import { OpticalEvaluation } from '../windows/analysis/opticalEvaluation/OpticalEvaluation.js';
import { ColorEvaluation } from '../windows/analysis/colorEvaluation/ColorEvaluation.js';
import { MaterialEditor } from '../windows/design/materialEditor/MaterialEditor.js';
import { NkCharacterization } from '../windows/dataExchange/nkCharacterization/NkCharacterization.js';
import { Refinement } from '../windows/optimization/refinement/Refinement.js';
import { MeritFunctionEditor } from '../windows/optimization/meritFunctionEditor/MeritFunctionEditor.js';
import { NeedleVariation } from '../windows/optimization/needleVariation/NeedleVariation.js';
import { NeedleManual } from '../windows/optimization/needleManual/NeedleManual.js';
import { GradualEvolution } from '../windows/optimization/gradualEvolution/GradualEvolution.js';
import { StructuralOptimizer } from '../windows/optimization/structuralOptimizer/StructuralOptimizer.js';
import { AdmittanceDiagram } from '../windows/analysis/admittanceDiagram/AdmittanceDiagram.js';
import { EFieldEvaluation } from '../windows/analysis/eFieldEvaluation/EFieldEvaluation.js';
import { EllipsometryEvaluation } from '../windows/analysis/ellipsometryEvaluation/EllipsometryEvaluation.js';
import { GDGDDEvaluation } from '../windows/analysis/gdGddEvaluation/GDGDDEvaluation.js';
import { MaterialDispersionEvaluation } from '../windows/analysis/materialDispersion/MaterialDispersionEvaluation.js';
import { RefractiveIndexProfiler } from '../windows/analysis/refractiveIndexProfiler/RefractiveIndexProfiler.js';
import { LayerThicknesses } from '../windows/analysis/layerThicknesses/LayerThicknesses.js';
import { LayerSensitivity } from '../windows/analysis/layerSensitivity/LayerSensitivity.js';
import { ErrorAnalysis } from '../windows/analysis/errorAnalysis/ErrorAnalysis.js';
import { IntegralValues } from '../windows/analysis/integralValues/IntegralValues.js';
import { DesignCleaner } from '../windows/optimization/designCleaner/DesignCleaner.js';
import { HistoryWindow } from '../windows/edit/HistoryWindow.js';
import { ProcessSimulator } from '../windows/dataExchange/processSimulator/ProcessSimulator.js';
import { ZemaxCoatings } from '../windows/dataExchange/zemaxCoatings/ZemaxCoatings.js';
import { CodevCoatings } from '../windows/dataExchange/codevCoatings/CodevCoatings.js';
import { SpectrumExchange } from '../windows/dataExchange/spectrumExchange/SpectrumExchange.js';
import { MeasuredEllipsometry } from '../windows/dataExchange/measuredEllipsometry/MeasuredEllipsometry.js';
import { Variator } from '../windows/optimization/variator/Variator.js';
import { SystematicDeviations } from '../windows/analysis/systematicDeviations/SystematicDeviations.js';
import { Inhomogeneities } from '../windows/analysis/inhomogeneities/Inhomogeneities.js';
import { RoughnessScattering } from '../windows/analysis/roughnessScattering/RoughnessScattering.js';
import { StressAnalysis } from '../windows/analysis/stressAnalysis/StressAnalysis.js';
import { PlotEngine } from '../windows/analysis/plotEngine/PlotEngine.js';
import { WavelengthAngleMap } from '../windows/analysis/wavelengthAngleMap/WavelengthAngleMap.js';
import { Specification } from '../windows/design/specification/Specification.js';
import { CoatingLibrary } from '../windows/design/coatingLibrary/CoatingLibrary.js';
import { OptimizerBenchmark } from '../windows/optimization/optimizerBenchmark/OptimizerBenchmark.js';
import { DeepSynthesis } from '../windows/optimization/deepSynthesis/DeepSynthesis.js';
import { MonitorWorksheet } from '../windows/simulation/monitorWorksheet/MonitorWorksheet.js';
import { ReportWindow } from '../windows/information/report/ReportWindow.js';
import { Games } from '../windows/information/games/Games.js';

export const WINDOW_REGISTRY = {
  // ── Design ──────────────────────────────────────────────────────────────────
  'design-editor':   { component: DesignEditor,        title: 'Design Editor',        label: 'Design Editor: layer stack table',                                    help: 'design/design-editor', requiresDesign: true },
  // Browses, imports and edits the material catalogs, which belong to no design.
  'material-editor': { component: MaterialEditor,       title: 'Material Editor',       label: 'Material Editor: n,k database',                                        help: 'design/material-editor', dialog: true },
  // Browsing coatings needs no design; Apply and Save current coating are off without one.
  'coating-library': { component: CoatingLibrary,       title: 'Coating Library',       label: 'Coating Library: reusable coating stacks, yours and the built-in starting designs', help: 'design/coating-library' },
  'specification':   { component: Specification,        title: 'Specification',         label: 'Specification: design requirements (PASS/FAIL qualifiers)',             help: 'design/specification', theme: true, dialog: true, requiresDesign: true, requiresResolvedMaterials: true },
  'merit-function':  { component: MeritFunctionEditor,  title: 'Merit Function Editor', label: 'Merit Function Editor: operand table',                                 help: 'design/merit-function-editor', dialog: true, requiresDesign: true, requiresResolvedMaterials: true },
  'variator':        { component: Variator,             title: 'Variator',              label: 'Variator: live parameter slider',                                      help: 'design/variator', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  // The undo history of the open design; with none open there is no history.
  'history':         { component: HistoryWindow,        title: 'History',               label: 'History: design undo/redo tree',                                       help: 'design/history', theme: true, requiresDesign: true },

  // ── Analysis ────────────────────────────────────────────────────────────────
  'optical-eval':    { component: OpticalEvaluation,         title: 'Optical Evaluation',          label: 'Optical Evaluation: T/R/A plots',                                 help: 'analysis/optical-evaluation', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'wavelength-angle-map': { component: WavelengthAngleMap,   title: 'Wavelength vs Angle',         label: 'Wavelength vs Angle: T, R or A mapped over wavelength and angle of incidence', help: 'analysis/wavelength-angle-map', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'color-eval':      { component: ColorEvaluation,           title: 'Color Evaluation',            label: 'Color Evaluation: CIE diagram',                                   help: 'analysis/color-evaluation', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'admittance':      { component: AdmittanceDiagram,         title: 'Admittance Diagram',          label: 'Admittance Diagram: locus plot',                                  help: 'analysis/admittance', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'efield':          { component: EFieldEvaluation,          title: 'Electric Field',              label: 'Electric Field: |E(z)|² vs depth',                                help: 'analysis/efield', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'ellipsometry':    { component: EllipsometryEvaluation,    title: 'Ellipsometry',                label: 'Ellipsometry: Ψ(λ) and Δ(λ)',                                     help: 'analysis/ellipsometry', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'gd-gdd':          { component: GDGDDEvaluation,           title: 'Group Delay / GDD',           label: 'Group Delay / GDD: dispersion',                                   help: 'analysis/gd-gdd', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  // Plots a material picked from the catalogs, not the design's stack.
  'material-dispersion': { component: MaterialDispersionEvaluation, title: 'Material Dispersion', label: 'Material Dispersion: bulk phase, GD, GDD, and TOD', help: 'analysis/material-dispersion', theme: true },
  'ri-profiler':     { component: RefractiveIndexProfiler,   title: 'RI Profiler',                 label: 'RI Profiler: n(z) and k(z)',                                      help: 'analysis/refractive-index-profile', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'layer-thicknesses': { component: LayerThicknesses,        title: 'Layer Thicknesses',           label: 'Layer Thicknesses: per-layer bar diagram',                        help: 'analysis/layer-thicknesses', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'sensitivity':     { component: LayerSensitivity,          title: 'Layer Sensitivity',           label: 'Layer Sensitivity: ∂MF/∂dᵢ',                                      help: 'analysis/layer-sensitivity', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'error-analysis':  { component: ErrorAnalysis,             title: 'Monte Carlo',                 label: 'Monte Carlo: manufacturing-error yield simulation',               help: 'analysis/error-analysis', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'integral-values': { component: IntegralValues,            title: 'Integral Values',             label: 'Integral Values: Tvis/Tsol/TUV/TNIR',                             help: 'analysis/integral-values', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'systematic-dev':  { component: SystematicDeviations,      title: 'Systematic Deviations',       label: 'Systematic Deviations: global perturbation sweep',                help: 'analysis/systematic-deviations', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'inhomogeneities': { component: Inhomogeneities,           title: 'Inhomogeneities & Interlayers', label: 'Inhomogeneities & Interlayers: graded interface transitions',   help: 'analysis/inhomogeneities', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'roughness':       { component: RoughnessScattering,       title: 'Roughness / Scattering',      label: 'Interface Roughness / Scattering: TIS(λ)',                        help: 'analysis/roughness-scattering', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'stress':          { component: StressAnalysis,             title: 'Stress',                      label: 'Stress: per-film stress, substrate bow, cracking and delamination margins', help: 'analysis/stress', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'plot-engine':     { component: PlotEngine,                title: 'Plot Engine',                 label: 'Plot Engine: custom XY plot builder',                             help: 'analysis/plot-engine', theme: true, requiresDesign: true, requiresResolvedMaterials: true },

  // ── Synthesis ─────────────────────────────────────────────────────────────────
  'refinement':      { component: Refinement,        title: 'Refinement',        label: 'Refinement: SQP (default) / DLS / CG / Newton / Newton-CG / DLS multi-start / DE / Simulated Annealing (pick method, or Try-all)', help: 'synthesis/refinement', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'needle':          { component: NeedleVariation,   title: 'Needle Automatic',  label: 'Needle Automatic: automatic layer insertion loop',                                             help: 'synthesis/needle', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'needle-manual':   { component: NeedleManual,      title: 'Needle Manual',     label: 'Needle Manual: pick position + material by hand',                                               help: 'synthesis/needle', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'gradual':         { component: GradualEvolution,  title: 'Gradual Evolution', label: 'Gradual Evolution: layer count ramp',                                                           help: 'synthesis/gradual-evolution', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'structural':      { component: StructuralOptimizer, title: 'Structural Optimizer', label: 'Structural Optimizer: random add/remove/split/merge layer mutations + simulated-annealing accept', help: 'synthesis/structural-optimizer', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'design-cleaner':  { component: DesignCleaner,     title: 'Design Cleaner',    label: 'Design Cleaner: merge thin layers',                                                             help: 'synthesis/design-cleaner', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  'filter-design':   {                                                                                                                                                                    help: 'synthesis/wdm-wizard' },

  // ── Simulation ────────────────────────────────────────────────────────────────
  'monitor-worksheet': { component: MonitorWorksheet, title: 'Monitor Worksheet', label: 'Monitor Worksheet: per-layer signal, swing and termination error on the witness chips the run would be monitored on', help: 'simulation/monitor-worksheet', requiresDesign: true, requiresResolvedMaterials: true },

  // ── Data Exchange ──────────────────────────────────────────────────────────────
  'process-sim':     { component: ProcessSimulator,  title: 'Process Exporter',   label: 'Process Exporter: scrub through deposition + export .res files', help: 'simulation/process-simulator', theme: true, requiresDesign: true, requiresResolvedMaterials: true },
  // Their Import tabs open a coating file and save it to the Coating Library
  // without a design; importing it into the front or back is off without one.
  'zemax-coatings':  { component: ZemaxCoatings,     title: 'Zemax Coatings',     label: 'Zemax Coatings: import / export COATING.DAT (materials + coatings)', help: 'data-exchange/zemax-coatings', theme: true, dialog: true },
  'codev-coatings':  { component: CodevCoatings,     title: 'CODE V Coatings',    label: 'CODE V Coatings: import / export CODE V MUL coatings (.seq, .mul)', help: 'data-exchange/codev-coatings', theme: true },
  // Measured curves are kept in the design: without one there is nothing to
  // import into, and nothing measured or calculated to export.
  'spectrum-exchange': { component: SpectrumExchange, title: 'Measured Spectra',   label: 'Measured Spectra: import measured R/T/A spectra (CSV/TXT/ASCII/JCAMP-DX) as overlays; export design or measured spectra to CSV/JCAMP-DX', help: 'data-exchange/measured-spectra', theme: true, requiresDesign: true },
  'measured-ellipsometry': { component: MeasuredEllipsometry, title: 'Measured Ellipsometry', label: 'Measured Ellipsometry: import measured Ψ/Δ from a spectroscopic ellipsometer; export measured or calculated Ψ/Δ to CSV', help: 'data-exchange/measured-ellipsometry', theme: true, requiresDesign: true },
  // Fits the measured curves the design holds, so it has nothing to fit without one.
  'nk-characterization': { component: NkCharacterization, title: 'n,k Characterization', label: 'n,k Characterization: derive the n, k and thickness of a film from a measured R/T spectrum or a measured Ψ/Δ pair', help: 'data-exchange/nk-characterization', theme: true, dialog: true, createDesign: true, requiresDesign: true },
  // Can report over designs picked in the explorer while none is open.
  'report-gen':      { component: ReportWindow,     title: 'Report',             label: 'Report: a document built from blocks over one or several designs, saved as PDF or HTML', help: 'data-exchange/report-generator', theme: true, requiresResolvedMaterials: true },

  // ── Dev / QA (opened from the dev-only View menu; not in the user ribbon) ───────
  // Runs its own built-in cases, whatever design is open.
  'optimizer-benchmark': { component: OptimizerBenchmark, title: 'Optimizer Benchmark', label: 'Optimizer Benchmark: live cross-optimizer comparison (dev/QA)', help: 'index', theme: true, requiresResolvedMaterials: true },
  // Experimental: opened from the application menu until it moves to the ribbon.
  'deep-synthesis':      { component: DeepSynthesis,      title: 'Deep Synthesis',      label: 'Deep Synthesis: gradual evolution with the deep needle, then a search over the layer structure (experimental)', help: 'index', theme: true, requiresDesign: true, requiresResolvedMaterials: true },

  // ── Not in any ribbon tab: offered in the application menu only after the
  //    version number in About has been clicked seven times ────────────────────
  'games':           { component: Games,            title: 'Games',              label: 'Games', help: 'index' },
};

// ── Derived tables (kept byte-equivalent to the old hand-maintained maps) ──────

export const TOOL_CONFIGS = Object.fromEntries(
  Object.entries(WINDOW_REGISTRY)
    .filter(([, e]) => e.title != null)
    .map(([id, e]) => [id, { title: e.title }]));

export const TOOL_LABELS = Object.fromEntries(
  Object.entries(WINDOW_REGISTRY)
    .filter(([, e]) => e.label != null)
    .map(([id, e]) => [id, e.label]));

export function helpAnchorFor(toolId) {
  return WINDOW_REGISTRY[toolId]?.help || 'index';
}

// A tool's window title, localized. The locale is asked first so a persisted
// layout (which baked the English title in at creation) re-localizes on a
// language switch; the registry title covers the few tools with no
// `windowTitles` entry.
export function windowTitle(toolId, t) {
  return t.windowTitles[toolId] || WINDOW_REGISTRY[toolId]?.title || toolId;
}
