/**
 * The Color Evaluation results as tables: one row per angle, the colour in
 * each colour space the window reports (Table), and how far each angle's colour
 * is from the first angle's (Differences). For a single angle the Table has a
 * row per space instead. Values are kept at full precision; the
 * columns format them for display, and the CSV writes them whole.
 *
 * Under All, the window's reports are each environment's angles in turn, each
 * naming its environment in `env` (colorModel.js, shownReports): the tables
 * then have a row per environment and angle, the environment first, and the
 * Differences measure each environment against the first one at the same
 * angle. The column functions read the Environment column's name from
 * `ce.environmentColumn`.
 */

import { ciede2000 } from '../../../../utils/physics/colorimetry.js';
import { formatTheta } from '../opticalEvaluation/model.js';
import { formatValue } from './colorModel.js';

const finiteOrNull = value => (Number.isFinite(value) ? value : null);

// A row's environment, under All, by its label.
const environmentOf = env => (env ? { env: env.label } : {});

/** Every quantity the window reports, one row per angle, under All per environment and angle. */
export function colorRows(reports) {
    return (reports || []).map(({ theta, report: r, env }) => ({
        ...environmentOf(env),
        aoi: theta,
        x: r.xy.x, y: r.xy.y, Y: r.XYZ.Y, X: r.XYZ.X, Z: r.XYZ.Z,
        L: r.Lab.L, a: r.Lab.a, b: r.Lab.b, Cab: r.Lab.C, hab: r.Lab.h,
        us: r.Luv.u, vs: r.Luv.v, Cuv: r.Luv.C, huv: r.Luv.h, suv: r.Luv.s,
        up: r.uvP.up, vp: r.uvP.vp, u60: r.uv60.u, v60: r.uv60.v,
        hL: r.Hunter.L, ha: r.Hunter.a, hb: r.Hunter.b,
        dominant: r.dom.dom, complementary: r.dom.comp, purity: r.dom.purity,
        cct: finiteOrNull(r.cct.cct), duv: finiteOrNull(r.cct.duv),
    }));
}

/**
 * Whether the Differences measure each environment against the first one at
 * the same angle: under All with more than one environment shown. With one,
 * they measure each angle against the first, as for a single environment.
 */
export function acrossEnvironments(reports) {
    const first = reports?.[0];
    return Boolean(first?.env) && reports.some(entry => entry.env.number !== first.env.number);
}

// What each report's colour is measured against: the first report's, or
// across environments the first environment's at the report's own angle,
// every environment being computed at the same angles.
function referenceLab(reports) {
    const [first] = reports;
    if (!acrossEnvironments(reports)) return () => first.report.Lab;
    const byAngle = new Map(reports
        .filter(entry => entry.env.number === first.env.number)
        .map(entry => [entry.theta, entry.report.Lab]));
    return theta => byAngle.get(theta) ?? first.report.Lab;
}

/**
 * Each angle's colour against the first angle's, or under All each
 * environment's against the first environment's at the same angle: ΔL*, Δa*,
 * Δb*; ΔE*ab, the straight-line distance between the two in CIELAB, which that
 * space is built to make proportional to the difference seen (Macleod,
 * Thin-Film Optical Filters 5th ed., §12.2); and ΔE00, CIEDE2000 (Sharma, Wu
 * and Dalal, Color Res. Appl. 30, 21 (2005)).
 */
export function differenceRows(reports) {
    if (!reports?.length) return [];
    const against = referenceLab(reports);
    return reports.map(({ theta, report, env }) => {
        const lab = report.Lab;
        const reference = against(theta);
        const dL = lab.L - reference.L;
        const da = lab.a - reference.a;
        const db = lab.b - reference.b;
        return {
            ...environmentOf(env), aoi: theta,
            dL, da, db, dEab: Math.hypot(dL, da, db), dE00: ciede2000(reference, lab),
        };
    });
}

const column = (key, label, digits, extra = {}) => ({ key, label, fmt: value => formatValue(value, digits), ...extra });
const aoiColumn = ce => ({ key: 'aoi', label: ce.aoi, align: 'left', fmt: formatTheta });
const environmentColumn = ce => ({ key: 'env', label: ce.environmentColumn, align: 'left', fmt: value => value ?? '' });
// The columns before the colour's: the angle, after the environment under All.
const leadColumns = (reports, ce) => (reports?.[0]?.env ? [environmentColumn(ce), aoiColumn(ce)] : [aoiColumn(ce)]);

// The colour spaces the Table shows one at a time, each named as the readout
// has always named it and laid out as its columns. Coordinate symbols are the
// same in every language.
const SPACES = [
    { id: 'xyY', name: ce => ce.xyY, columns: () => [column('x', 'x', 4), column('y', 'y', 4), column('Y', 'Y', 3)] },
    { id: 'XYZ', name: ce => ce.XYZ, columns: () => [column('X', 'X', 3), column('Y', 'Y', 3), column('Z', 'Z', 3)] },
    { id: 'lab', name: () => 'CIE L*a*b*', columns: () => [column('L', 'L*', 3), column('a', 'a*', 3), column('b', 'b*', 3)] },
    {
        id: 'lchab', name: () => 'L* C*ab h°ab',
        columns: () => [column('L', 'L*', 3), column('Cab', 'C*ab', 3), column('hab', 'h°ab', 2)],
    },
    { id: 'luv', name: () => 'CIE L*u*v*', columns: () => [column('L', 'L*', 3), column('us', 'u*', 3), column('vs', 'v*', 3)] },
    {
        id: 'lchuv', name: () => 'L* C*uv h°uv suv',
        columns: () => [column('L', 'L*', 3), column('Cuv', 'C*uv', 3), column('huv', 'h°uv', 2), column('suv', 'suv', 4)],
    },
    { id: 'uv1976', name: () => 'u′ v′ (1976)', columns: () => [column('up', 'u′', 4), column('vp', 'v′', 4)] },
    { id: 'uv1960', name: () => 'u v (1960)', columns: () => [column('u60', 'u', 4), column('v60', 'v', 4)] },
    { id: 'hunter', name: () => 'Hunter Lab', columns: () => [column('hL', 'L', 3), column('ha', 'a', 3), column('hb', 'b', 3)] },
    {
        id: 'dominant', name: ce => ce.dominant,
        columns: (ce, units) => [
            column('dominant', `${ce.dominant} (${units.nm})`, 1),
            column('complementary', `${ce.complementary} (${units.nm})`, 1),
            column('purity', `${ce.purityCol} (%)`, 2, { scale: 100, fmt: value => formatValue(value * 100, 2) }),
        ],
    },
    {
        id: 'cct', name: () => 'CCT / Duv',
        columns: (ce, units) => [column('cct', `CCT (${units.K})`, 0), column('duv', 'Duv', 4)],
    },
];

export const TABLE_SPACE_IDS = SPACES.map(space => space.id);

/** The spaces as dropdown options. */
export function tableSpaceOptions(ce) {
    return SPACES.map(space => ({ id: space.id, label: space.name(ce) }));
}

/** The Table's columns for one colour space, after the angle and, under All, the environment. */
export function tableColumns(spaceId, ce, units, reports) {
    const space = SPACES.find(item => item.id === spaceId) || SPACES[0];
    return [...leadColumns(reports, ce), ...space.columns(ce, units)];
}

/**
 * The Table for one angle, where a row per angle would hold two or three
 * numbers: every colour space at once, one row each, as its quantities' names
 * and values.
 */
export function spaceRows(report, ce, units) {
    const [row] = colorRows([{ theta: 0, report }]);
    return SPACES.map(space => ({
        id: space.id,
        space: space.name(ce),
        pairs: space.columns(ce, units).map(col => ({ label: col.label, value: col.fmt(row[col.key]) })),
    }));
}

// What each angle's line under the diagram holds: the chromaticity and
// luminance, the CIELAB coordinates, and the dominant or complementary
// wavelength with the purity, the values compared from angle to angle. The
// other spaces are in the Table.
const LINE_SPACES = ['xyY', 'lab', 'dominant'];
// On the line the two wavelengths go by their CIE 15:2004 symbols, which keep
// a line of eight values inside a window docked at half the screen; the full
// names are their titles, and the Table and the CSV use them.
const LINE_SYMBOLS = {
    dominant: units => `λd (${units.nm})`,
    complementary: units => `λc (${units.nm})`,
};

/**
 * The values on an angle's line under the diagram, as { key, label, title,
 * value }. A colour has a dominant wavelength or, as a purple, a complementary
 * one, so the line carries whichever it has and every line has the same eight
 * places.
 */
export function linePairs(report, ce, units) {
    const [row] = colorRows([{ theta: 0, report }]);
    const unused = Number.isFinite(row.dominant) ? 'complementary' : 'dominant';
    return LINE_SPACES
        .flatMap(id => SPACES.find(space => space.id === id).columns(ce, units))
        .filter(col => col.key !== unused)
        .map(col => ({
            key: col.key,
            label: LINE_SYMBOLS[col.key] ? LINE_SYMBOLS[col.key](units) : col.label,
            title: col.label,
            value: col.fmt(row[col.key]),
        }));
}

/**
 * What the Table or Differences view shows: the differences, or a row per
 * angle in one space, as { columns, rows }; or for one angle's Table, a row
 * per space as spaceRows gives them, with no columns. Under All the rows are
 * per environment and angle, so one angle in several environments is a row
 * each.
 */
export function viewTable(reports, { resultsView, tableSpace }, ce, units) {
    if (resultsView === 'differences') return { columns: differenceColumns(ce, reports), rows: differenceRows(reports) };
    if (reports.length === 1) return { columns: null, rows: spaceRows(reports[0].report, ce, units) };
    return { columns: tableColumns(tableSpace, ce, units, reports), rows: colorRows(reports) };
}

/** The Differences view's columns. */
export function differenceColumns(ce, reports) {
    return [
        ...leadColumns(reports, ce), column('dL', 'ΔL*', 3), column('da', 'Δa*', 3), column('db', 'Δb*', 3),
        column('dEab', 'ΔE*ab', 3), column('dE00', 'ΔE00', 3),
    ];
}

/**
 * Everything the window reports, for the CSV: the angle, after the
 * environment under All, every colour space once, and the differences,
 * whichever view is open.
 */
export function exportTable(reports, ce, units) {
    const lead = leadColumns(reports, ce);
    const columns = [...lead];
    const seen = new Set(lead.map(col => col.key));
    for (const space of SPACES) {
        for (const col of space.columns(ce, units)) {
            if (seen.has(col.key)) continue;
            seen.add(col.key);
            columns.push(col);
        }
    }
    const differences = differenceColumns(ce, reports).slice(lead.length);
    const extra = differenceRows(reports);
    const rows = colorRows(reports).map((row, i) => ({ ...row, ...extra[i] }));
    return { columns: [...columns, ...differences], rows };
}
