/**
 * Window registry — the single source of truth for dockable tool windows.
 *
 * Adding a tool window used to mean editing five places in DockingLayout.js (the
 * import block, the `ToolContent` if-chain, `TOOL_CONFIGS`, `TOOL_LABELS`, and
 * `HELP_ANCHORS`) plus the Toolbar and locales. Now everything DockingLayout
 * needs lives in ONE entry here; DockingLayout derives its tables from this map.
 *
 * Each entry (all fields optional except as noted):
 *   component  React window component. Omit (or null) for a tool that is NOT a
 *              docked window — a modal/wizard handled elsewhere, or a stub. Such
 *              ids may still carry a title/label/help; ToolContent falls through
 *              to the placeholder for them (unchanged behavior).
 *   title      Tab title (→ TOOL_CONFIGS[id].title). Omit → id is used.
 *   label      Placeholder / description text (→ TOOL_LABELS[id]).
 *   help       Starlight help-site slug (→ helpAnchorFor). Omit → '/index/'.
 *   theme      Pass the `theme` prop to the component (most windows need it).
 *   dialog     Pass the `setInputDialog` prop (editors that prompt for input).
 *
 * Props contract preserved exactly from the old ToolContent: every window gets
 * { c, t }; `theme:true` adds `theme`; `dialog:true` adds `setInputDialog`.
 */

import { DesignEditor } from '../windows/DesignEditor.js';
import { OpticalEvaluation } from '../windows/OpticalEvaluation.js';
import { ColorEvaluation } from '../windows/ColorEvaluation.js';
import { MaterialEditor } from '../windows/MaterialEditor.js';
import { Refinement } from '../windows/Refinement.js';
import { MeritFunctionEditor } from '../windows/MeritFunctionEditor.js';
import { NeedleVariation } from '../windows/NeedleVariation.js';
import { NeedleManual } from '../windows/NeedleManual.js';
import { GradualEvolution } from '../windows/GradualEvolution.js';
import { StructuralOptimizer } from '../windows/StructuralOptimizer.js';
import { AdmittanceDiagram } from '../windows/AdmittanceDiagram.js';
import { EFieldEvaluation } from '../windows/EFieldEvaluation.js';
import { EllipsometryEvaluation } from '../windows/EllipsometryEvaluation.js';
import { GDGDDEvaluation } from '../windows/GDGDDEvaluation.js';
import { RefractiveIndexProfiler } from '../windows/RefractiveIndexProfiler.js';
import { LayerSensitivity } from '../windows/LayerSensitivity.js';
import { ErrorAnalysis } from '../windows/ErrorAnalysis.js';
import { IntegralValues } from '../windows/IntegralValues.js';
import { DesignCleaner } from '../windows/DesignCleaner.js';
import { HistoryWindow } from '../windows/HistoryWindow.js';
import { ProcessSimulator } from '../windows/ProcessSimulator.js';
import { ZemaxCoatings } from '../windows/ZemaxCoatings.js';
import { SpectrumExchange } from '../windows/SpectrumExchange.js';
import { Variator } from '../windows/Variator.js';
import { SystematicDeviations } from '../windows/SystematicDeviations.js';
import { Inhomogeneities } from '../windows/Inhomogeneities.js';
import { RoughnessScattering } from '../windows/RoughnessScattering.js';
import { PlotEngine } from '../windows/PlotEngine.js';
import { Specification } from '../windows/Specification.js';
import { OptimizerBenchmark } from '../windows/OptimizerBenchmark.js';

export const WINDOW_REGISTRY = {
  // ── Design ──────────────────────────────────────────────────────────────────
  'design-editor':   { component: DesignEditor,        title: 'Design Editor',        label: 'Design Editor — layer stack table',                                   help: 'design/design-editor' },
  'material-editor': { component: MaterialEditor,       title: 'Material Editor',       label: 'Material Editor — n,k database',                                       help: 'design/material-editor', dialog: true },
  'specification':   { component: Specification,        title: 'Specification',         label: 'Specification — design requirements (PASS/FAIL qualifiers)',            help: 'design/specification', theme: true, dialog: true },
  'merit-function':  { component: MeritFunctionEditor,  title: 'Merit Function Editor', label: 'Merit Function Editor — operand table',                                help: 'design/merit-function-editor', dialog: true },
  'variator':        { component: Variator,             title: 'Variator',              label: 'Variator — live parameter slider',                                     help: 'design/variator', theme: true },
  'history':         { component: HistoryWindow,        title: 'History',               label: 'History — design undo/redo tree',                                      help: 'design/history', theme: true },

  // ── Analysis ────────────────────────────────────────────────────────────────
  'optical-eval':    { component: OpticalEvaluation,         title: 'Optical Evaluation',          label: 'Optical Evaluation — T/R/A plots',                                help: 'analysis/optical-evaluation', theme: true },
  'color-eval':      { component: ColorEvaluation,           title: 'Color Evaluation',            label: 'Color Evaluation — CIE diagram',                                  help: 'analysis/color-evaluation', theme: true },
  'admittance':      { component: AdmittanceDiagram,         title: 'Admittance Diagram',          label: 'Admittance Diagram — locus plot',                                 help: 'analysis/admittance', theme: true },
  'efield':          { component: EFieldEvaluation,          title: 'Electric Field',              label: 'Electric Field — |E(z)|² vs depth',                               help: 'analysis/efield', theme: true },
  'ellipsometry':    { component: EllipsometryEvaluation,    title: 'Ellipsometry',                label: 'Ellipsometry — Ψ(λ) and Δ(λ)',                                    help: 'analysis/ellipsometry', theme: true },
  'gd-gdd':          { component: GDGDDEvaluation,           title: 'Group Delay / GDD',           label: 'Group Delay / GDD — dispersion',                                  help: 'analysis/gd-gdd', theme: true },
  'ri-profiler':     { component: RefractiveIndexProfiler,   title: 'RI Profiler',                 label: 'RI Profiler — n(z) and k(z)',                                     help: 'analysis/refractive-index-profile', theme: true },
  'sensitivity':     { component: LayerSensitivity,          title: 'Layer Sensitivity',           label: 'Layer Sensitivity — ∂MF/∂dᵢ',                                     help: 'analysis/layer-sensitivity', theme: true },
  'error-analysis':  { component: ErrorAnalysis,             title: 'Monte-Carlo',                 label: 'Monte-Carlo — manufacturing-error yield simulation',              help: 'analysis/error-analysis', theme: true },
  'integral-values': { component: IntegralValues,            title: 'Integral Values',             label: 'Integral Values — Tvis/Tsol/TUV/TNIR',                            help: 'analysis/integral-values', theme: true },
  'systematic-dev':  { component: SystematicDeviations,      title: 'Systematic Deviations',       label: 'Systematic Deviations — global perturbation sweep',               help: 'analysis/systematic-deviations', theme: true },
  'inhomogeneities': { component: Inhomogeneities,           title: 'Inhomogeneities & Interlayers', label: 'Inhomogeneities & Interlayers — graded interface transitions',  help: 'analysis/inhomogeneities', theme: true },
  'roughness':       { component: RoughnessScattering,       title: 'Roughness / Scattering',      label: 'Interface Roughness / Scattering — TIS(λ)',                       help: 'analysis/roughness-scattering', theme: true },
  'plot-engine':     { component: PlotEngine,                title: 'Plot Engine',                 label: 'Plot Engine — custom XY plot builder',                            help: 'analysis/plot-engine', theme: true },

  // ── Synthesis ─────────────────────────────────────────────────────────────────
  'refinement':      { component: Refinement,        title: 'Refinement',        label: 'Refinement — SQP (default) / DLS / CG / Newton / Newton-CG / DLS multi-start / DE / Simulated Annealing (pick method, or Try-all)', help: 'synthesis/refinement', theme: true },
  'needle':          { component: NeedleVariation,   title: 'Needle Automatic',  label: 'Needle Automatic — automatic layer insertion loop',                                            help: 'synthesis/needle', theme: true },
  'needle-manual':   { component: NeedleManual,      title: 'Needle Manual',     label: 'Needle Manual — pick position + material by hand',                                              help: 'synthesis/needle', theme: true },
  'gradual':         { component: GradualEvolution,  title: 'Gradual Evolution', label: 'Gradual Evolution — layer count ramp',                                                          help: 'synthesis/gradual-evolution', theme: true },
  'structural':      { component: StructuralOptimizer, title: 'Structural Optimizer', label: 'Structural Optimizer — random add/remove/split/merge layer mutations + simulated-annealing accept', help: 'synthesis/structural-optimizer', theme: true },
  'design-cleaner':  { component: DesignCleaner,     title: 'Design Cleaner',    label: 'Design Cleaner — merge thin layers',                                                            help: 'synthesis/design-cleaner', theme: true },
  'filter-design':   {                                                                                                                                                                    help: 'synthesis/wdm-wizard' },

  // ── Simulation ────────────────────────────────────────────────────────────────

  // ── Data Exchange ──────────────────────────────────────────────────────────────
  'process-sim':     { component: ProcessSimulator,  title: 'Process Exporter',   label: 'Process Exporter — scrub through deposition + export .res files', help: 'simulation/process-simulator', theme: true },
  'zemax-coatings':  { component: ZemaxCoatings,     title: 'Zemax Coatings',     label: 'Zemax Coatings — import / export COATING.DAT (materials + coatings)', help: 'data-exchange/zemax-coatings', theme: true, dialog: true },
  'spectrum-exchange': { component: SpectrumExchange, title: 'Measured Spectra',   label: 'Measured Spectra — import measured R/T/A (CSV/TXT/ASCII/JCAMP-DX) as overlays; export design or measured spectra to CSV/JCAMP-DX', help: 'data-exchange/measured-spectra', theme: true },

  // ── Dev / QA (opened from the dev-only View menu; not in the user ribbon) ───────
  'optimizer-benchmark': { component: OptimizerBenchmark, title: 'Optimizer Benchmark', label: 'Optimizer Benchmark — live cross-optimizer comparison (dev/QA)', help: 'index', theme: true },
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
