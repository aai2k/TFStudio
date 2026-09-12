import { depthScale } from './xScale.js';
import {
    componentOf, curveLabel, formatCell, incidentAmplitudeVpm, plotValue, yScaleOf,
} from './yScale.js';

// Which polarizations are drawn, in drawing order. Choosing avg shows the mean
// with the two polarizations behind it; choosing one shows only that one.
const CURVE_KEYS = { avg: ['avg', 's', 'p'], s: ['s'], p: ['p'] };

/**
 * The curves on the plot, in the chosen quantity and component.
 *
 * `display` is `{ quantity, component, xUnit }` from the window's settings
 * menu. The engine returns each component as a fraction of the incident |E|²,
 * so an absolute reading needs the incident index, which the profile carries.
 * `z` comes back in the chosen depth unit, so the plot and the table place
 * every reading at the same coordinate.
 */
export function plottedCurves(profileData, pol, tr, display) {
    if (!profileData) return [];
    const { quantity, component } = display;
    const toAxis = plotValue(quantity, incidentAmplitudeVpm(profileData.incidentIndex));
    const toDepth = depthScale(profileData, display.xUnit).map;
    const key = componentOf(component).key;
    const polSuffix = { avg: tr.polSuffixAvg, s: tr.polSuffixS, p: tr.polSuffixP };
    return (CURVE_KEYS[pol] || CURVE_KEYS.avg)
        .map(curveKey => ({ curveKey, profile: profileData[curveKey] }))
        .filter(({ profile }) => profile?.[key] && profile.z)
        .map(({ curveKey, profile }) => ({
            key: curveKey,
            label: curveLabel(quantity, component, polSuffix[curveKey]),
            z: toDepth(profile.z),
            y: profile[key].map(toAxis),
        }));
}

/**
 * The results table. Column headers carry the unit, so a file exported from
 * here is not read later as though it held percentages.
 */
export function buildProfileTable(profile, pol, tr, display) {
    const curves = plottedCurves(profile, pol, tr, display);
    if (!curves.length) return null;
    const unit = yScaleOf(display.quantity).unit;
    const depth = depthScale(profile, display.xUnit);
    const columns = [
        {
            key: 'z', label: tr.xColumns[depth.id], align: 'left',
            fmt: value => value.toFixed(depth.decimals),
        },
        ...curves.map((curve, index) => ({
            key: 'c' + index,
            label: `${curve.label} [${unit}]`,
            fmt: value => formatCell(display.quantity, value),
        })),
    ];
    const rows = curves[0].z.map((z, index) => {
        const row = { z };
        curves.forEach((curve, column) => { row['c' + column] = curve.y[index]; });
        return row;
    });
    return { columns, rows };
}
