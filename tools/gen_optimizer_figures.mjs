/**
 * Draw the figures of the manual's optimization pages: the merit function of a
 * two-layer antireflection coating as a contour map over the two thicknesses,
 * with the path one refinement method takes across it.
 *
 *   node tools/gen_optimizer_figures.mjs
 *
 * Writes docs-site/public/diagrams/optimization/<figure>.gif, the run step by
 * step ending on a held last frame, and a -zh twin whose labels are Chinese. The methods are the app's own engines, run as the Refinement window
 * runs them (optimizer-figures/landscape.mjs), so rerun this after changing an
 * engine and the figures follow it. The stochastic methods use a fixed seed,
 * so the output only changes when the code does.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import en from '../src/constants/locales/en.js';
import zh from '../src/constants/locales/zh.js';
import { DEFAULT_SETTINGS, defaultMaxIter } from '../src/utils/refinement/methods.js';
import { loadKernel, makeCase, meritGrid, runMethod, runMultiStart } from './optimizer-figures/landscape.mjs';
import * as draw from './optimizer-figures/draw.mjs';

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(PROJECT_ROOT, 'docs-site', 'public', 'diagrams', 'optimization');

// Every method starts from 160 nm of MgF2 on 200 nm of Ta2O5.
const CASE = { outer: 'MgF2', inner: 'Ta2O5', start: [160, 200] };
const RANGE = [0, 300];
const GRID_POINTS = 151;
const SEED = 7;

// One figure per Refinement method. `walk` draws every accepted move without
// dots, for a method that takes hundreds of them.
const FIGURES = [
    { name: 'refine-sqp', method: 'sqp' },
    { name: 'refine-dls', method: 'dls' },
    { name: 'refine-cg', method: 'cg' },
    { name: 'refine-newton', method: 'newton' },
    { name: 'refine-newton-cg', method: 'newton-cg' },
    { name: 'refine-trust-region', method: 'trust-region' },
    { name: 'refine-dls-multi', method: 'dls-multi' },
    { name: 'refine-de', method: 'de' },
    { name: 'refine-sa', method: 'sa', walk: true },
];

const subscript = name => name.replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);

const TEXT = {
    en: {
        methods: en.refinement.methods,
        thickness: m => `${subscript(m)} thickness (nm)`,
        start: 'Start',
        restarts: 'Perturbed starts',
        lowest: 'Lowest merit on the map',
        step: k => `Step ${k}`,
        title: m => `${m} on the merit function of a two-layer antireflection coating`,
        desc: (m, o, i) => `Contour map of the merit function over the ${o} and ${i} thicknesses of an antireflection coating on BK7, pale where the merit is low, with the path ${m} takes from the start.`,
    },
    zh: {
        methods: zh.refinement.methods,
        thickness: m => `${subscript(m)} 厚度 (nm)`,
        start: '起点',
        restarts: '扰动后的起点',
        lowest: '图中评价函数最低点',
        step: k => `第 ${k} 步`,
        title: m => `${m}在双层减反射膜评价函数上的路径`,
        desc: (m, o, i) => `BK7 上减反射膜的评价函数随 ${o} 与 ${i} 厚度变化的等高线图，颜色越浅评价函数越低，图中是${m}从起点出发所走的路径。`,
    },
};

// The runs one figure draws, and which of them is the result.
function runsOf(fig, kase) {
    if (fig.method === 'dls-multi') {
        const { nRestarts, perturbPct } = DEFAULT_SETTINGS;
        const runs = runMultiStart(kase, CASE.start, { n: nRestarts, pct: perturbPct, seed: SEED, maxIter: defaultMaxIter('dls-multi') });
        const best = runs.reduce((b, run, k) => (run.mfBest < runs[b].mfBest ? k : b), 0);
        return { runs, best };
    }
    return { runs: [runMethod(kase, fig.method, CASE.start, { seed: SEED })], best: 0 };
}

// The best member of a population run after each generation, from its best
// starting member, without repeats.
function bestTrace(run, k) {
    const trace = [run.current0, ...run.steps.slice(0, k).map(s => s.points.at(-1)).filter(Boolean)];
    return trace.filter((p, n) => n === 0 || p[0] !== trace[n - 1][0] || p[1] !== trace[n - 1][1]);
}

function populationAt(run, k) {
    if (k === 0) return run.population0;
    return run.steps[Math.min(k, run.steps.length) - 1].population;
}

function populationMarks(run, sc, k) {
    const color = draw.PATH_COLOR;
    const trace = bestTrace(run, k);
    // The finished run also shows where the population started.
    const first = k > 0 && k >= run.steps.length ? draw.populationMark(run.population0, color, sc, { faint: true }) : '';
    return first + draw.populationMark(populationAt(run, k), color, sc)
        + draw.pathMark(trace, color, sc, { dots: false, width: 1.8 })
        + draw.endMark(trace.at(-1), color, sc);
}

// The marks of a run as it stands after `k` steps; `minor` for a multi-start
// restart that is not the result.
function runMarks(run, sc, k, { walk = false, minor = false } = {}) {
    if (run.population0) return populationMarks(run, sc, k);
    const points = [run.start, ...run.steps.slice(0, k).flatMap(s => s.points)];
    const done = k >= run.steps.length;
    const end = done ? run.best : points.at(-1);
    if (minor) {
        return draw.pathMark(points, draw.PATH_COLOR, sc, { dots: false, width: 1.3, opacity: 0.55 })
            + draw.restartMark(run.start, sc) + draw.restartMark(end, sc, { filled: true });
    }
    const line = draw.pathMark(points, draw.PATH_COLOR, sc, walk ? { dots: false, width: 1.5 } : {});
    return line + draw.endMark(end, draw.PATH_COLOR, sc);
}

function legendRows(fig, set, text) {
    const swatch = set.runs[0].population0 ? draw.swatches.population : draw.swatches.line;
    const rows = [{ swatch: swatch(draw.PATH_COLOR), label: text.methods[fig.method] }];
    if (set.runs.length > 1) rows.push({ swatch: draw.swatches.restart(), label: text.restarts });
    rows.push({ swatch: draw.swatches.start(), label: text.start }, { swatch: draw.swatches.lowest(), label: text.lowest });
    return rows;
}

// The step after which a run no longer visibly moves: its last step, or for a
// population the first generation whose members all lie within 1 nm of each
// other in both thicknesses.
function settledStep(run) {
    if (!run.population0) return run.steps.length;
    const k = run.steps.findIndex(s => [0, 1].every(c => {
        const v = s.population.map(p => p[c]);
        return Math.max(...v) - Math.min(...v) < 1;
    }));
    return k < 0 ? run.steps.length : k + 1;
}

// Steps shown by the animation: every step at first, then every second, then
// every fifth, up to the step after which nothing moves, then the last step.
function frameSteps(runs) {
    const total = Math.max(...runs.map(run => run.steps.length));
    const moving = Math.max(...runs.map(settledStep));
    const ks = [];
    for (let k = 0; k <= moving; k += k < 30 ? 1 : k < 60 ? 2 : 5) ks.push(k);
    if (ks.at(-1) !== total) ks.push(total);
    return ks;
}

function frameSvg(ctx, k, note) {
    const { fig, set, sc, land, base, text } = ctx;
    const minor = set.runs.map((run, n) => (n === set.best ? '' : runMarks(run, sc, k, { minor: true }))).join('');
    const marks = draw.lowestMark(land.lowest, sc) + minor
        + runMarks(set.runs[set.best], sc, k, { walk: fig.walk }) + draw.startMark(CASE.start, sc);
    const name = text.methods[fig.method];
    return draw.figureSvg({
        base, marks, legendRows: legendRows(fig, set, text), note,
        title: text.title(name), desc: text.desc(name, CASE.outer, CASE.inner),
    });
}

async function writeGif(frames, file) {
    const pngs = await Promise.all(frames.map(svg => sharp(Buffer.from(svg)).png().toBuffer()));
    const delay = frames.map((_, k) => (k === 0 ? 900 : k === frames.length - 1 ? 3000 : 110));
    await sharp(pngs, { join: { animated: true } })
        .gif({ delay, loop: 0, effort: 10, colours: 64, dither: 0 })
        .toFile(file);
}

async function drawFigure(fig, kase, scene) {
    const set = runsOf(fig, kase);
    for (const [lang, text] of Object.entries(TEXT)) {
        const base = { bands: scene.bands, axes: draw.axes(scene.sc, { x: text.thickness(CASE.outer), y: text.thickness(CASE.inner) }) };
        const ctx = { ...scene, fig, set, text, base };
        const suffix = lang === 'en' ? '' : `-${lang}`;
        const frames = frameSteps(set.runs).map(k => frameSvg(ctx, k, text.step(k)));
        await writeGif(frames, path.join(OUT_DIR, `${fig.name}${suffix}.gif`));
    }
    const run = set.runs[set.best];
    console.log(`${fig.name}: ${run.iters} steps, MF ${run.mfBest.toFixed(5)} at ${run.best.map(d => d.toFixed(1)).join(', ')} nm`);
}

await loadKernel();
mkdirSync(OUT_DIR, { recursive: true });
const kase = makeCase(CASE);
const land = meritGrid(kase, { lo: RANGE[0], hi: RANGE[1], n: GRID_POINTS });
const sc = draw.makeScale(RANGE);
const scene = { land, sc, bands: await draw.bandImage(land) };
for (const fig of FIGURES) await drawFigure(fig, kase, scene);
