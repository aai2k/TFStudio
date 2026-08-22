/**
 * Needle Manual P-function plot — layer zones.
 *
 * The plot shades every layer of the stack so a candidate picked off a curve can
 * be read against the layer it lands in. What is checked here:
 *
 *   1. buildPlotData emits one band per layer, tiling [0, totalZ] with no gap or
 *      overlap, each carrying its layer index and material id.
 *   2. Neutral zone bands and boundary guides preserve the layer geometry and
 *      emphasize the layer hosting an intra-layer selection.
 *   3. A gap selection sits on a boundary rather than inside a layer, so it is
 *      marked with a line at that depth and leaves every zone unemphasized.
 *   4. Layer labels are dropped for zones too narrow to hold one, so a stack of
 *      hundreds of layers does not draw hundreds of numbers.
 */

import assert from 'node:assert/strict';
import { shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();

const { buildPlotData } =
    await import('../src/components/windows/optimization/needleManual/model.js');
const { buildBoundaryGuides, buildLayerLabels, buildZoneBands, hostLayerIndex } =
    await import('../src/components/windows/optimization/needleManual/plotShapes.js');

const COLORS = { gridColor: '#3a3a3a', selectionColor: '#ff0000', textColor: '#cccccc', dimColor: '#888888' };

function makeScan(thicknesses) {
    const layers = thicknesses.map((thickness, i) => ({
        material: i % 2 === 0 ? 'builtin:TiO2' : 'builtin:SiO2',
        thickness,
    }));
    const zb = [0];
    for (const t of thicknesses) zb.push(zb[zb.length - 1] + t);
    return { layers, zb, candidates: [], side: 'front' };
}

// ── 1. Bands tile the stack and carry their layer identity ───────────────────
{
    const thicknesses = [100, 60, 140, 80];
    const { bands, boundaries, totalZ } = buildPlotData(makeScan(thicknesses));

    assert.equal(bands.length, thicknesses.length, 'one band per layer');
    assert.equal(totalZ, 380);
    assert.equal(bands[0].z0, 0, 'first band starts at the incident interface');
    assert.equal(bands[bands.length - 1].z1, totalZ, 'last band ends at the substrate interface');

    bands.forEach((band, k) => {
        assert.equal(band.k, k, `band ${k} carries its layer index`);
        assert.equal(band.materialId, k % 2 === 0 ? 'builtin:TiO2' : 'builtin:SiO2');
        assert.equal(band.z1 - band.z0, thicknesses[k], `band ${k} spans its layer thickness`);
        if (k > 0) assert.equal(band.z0, bands[k - 1].z1, `band ${k} abuts its predecessor`);
    });
    assert.equal(boundaries.length, thicknesses.length + 1, 'boundaries include both outer edges');
}

// ── 2. Zones, guides and the emphasized host layer ───────────────────────────
{
    const { bands, boundaries } = buildPlotData(makeScan([100, 60, 140, 80]));
    const selected = { intra: true, layerK: 2, frac: 0.5, materialId: 'builtin:Ta2O5' };

    assert.equal(hostLayerIndex(selected), 2);

    const zones = buildZoneBands(bands, selected);
    const guides = buildBoundaryGuides(boundaries, selected, COLORS.gridColor, COLORS.selectionColor);

    assert.equal(zones.length, bands.length, 'one zone per layer');
    for (let index = 0; index < zones.length; index++) {
        assert.equal(zones[index].x0, bands[index].z0);
        assert.equal(zones[index].x1, bands[index].z1);
    }

    const host = zones[2];
    assert.ok(host.opacity > zones[0].opacity, 'the host layer is emphasized');
    assert.equal(host.selected, true, 'the host layer is selected');
    assert.equal(zones[0].selected, false, 'other layers are not selected');

    assert.equal(guides.length, boundaries.length - 2, 'a guide per interface, none on the outer edges');
    for (const guide of guides) assert.equal(guide.dash, 'dotted');
}

// ── 3. A gap selection marks a boundary, not a zone ──────────────────────────
{
    const { bands, boundaries } = buildPlotData(makeScan([100, 60, 140, 80]));
    const selected = { intra: false, pos: 2, materialId: 'builtin:Ta2O5' };

    assert.equal(hostLayerIndex(selected), -1, 'a gap has no host layer');

    const zones = buildZoneBands(bands, selected);
    const opacities = new Set(zones.map(zone => zone.opacity));
    assert.equal(opacities.size, 1, 'no zone is emphasized for a gap insertion');

    const marker = buildBoundaryGuides(boundaries, selected, COLORS.gridColor, COLORS.selectionColor)
        .filter(guide => guide.color === COLORS.selectionColor);
    assert.equal(marker.length, 1, 'the gap is marked once');
    assert.equal(marker[0].x, boundaries[2], 'the marker sits on the selected boundary');
    assert.equal(marker[0].x, 160);
}

// A gap at the outer edges still gets its marker, even though those boundaries
// carry no dotted guide.
{
    const { bands, boundaries } = buildPlotData(makeScan([100, 60]));
    for (const pos of [0, 2]) {
        const marker = buildBoundaryGuides(
            boundaries, { intra: false, pos, materialId: 'builtin:SiO2' },
            COLORS.gridColor, COLORS.selectionColor,
        ).filter(guide => guide.color === COLORS.selectionColor);
        assert.equal(marker.length, 1, `gap at position ${pos} is marked`);
        assert.equal(marker[0].x, boundaries[pos]);
    }
}

// ── 4. Labels are dropped for zones too narrow to read ───────────────────────
{
    const { bands, totalZ } = buildPlotData(makeScan([100, 60, 140, 80]));
    const labels = buildLayerLabels({ bands, totalZ, selected: null, ...COLORS });

    assert.equal(labels.length, bands.length, 'every zone of a short stack is labelled');
    assert.deepEqual(labels.map(l => l.text), ['1', '2', '3', '4'], 'labels are 1-based layer numbers');
    assert.equal(labels[0].x, 50, 'a label is centred on its zone');
    for (const label of labels) {
        assert.equal(label.color, COLORS.dimColor);
    }
}

{
    // 200 equal layers: every zone is 0.5 % of the axis, far below the threshold.
    const { bands, totalZ } = buildPlotData(makeScan(new Array(200).fill(10)));
    const labels = buildLayerLabels({ bands, totalZ, selected: null, ...COLORS });
    assert.equal(labels.length, 0, 'a dense stack draws no labels');
}

{
    // One layer wide enough to label among many that are not.
    const thicknesses = [...new Array(40).fill(5), 400];
    const { bands, totalZ } = buildPlotData(makeScan(thicknesses));
    const labels = buildLayerLabels({ bands, totalZ, selected: null, ...COLORS });
    assert.equal(labels.length, 1, 'only the wide zone is labelled');
    assert.equal(labels[0].text, '41');
}

// The host layer's label is drawn in the brighter text colour.
{
    const { bands, totalZ } = buildPlotData(makeScan([100, 60, 140, 80]));
    const labels = buildLayerLabels({
        bands, totalZ, selected: { intra: true, layerK: 1 }, ...COLORS,
    });
    assert.equal(labels[1].color, COLORS.textColor, 'the host layer label is emphasized');
    assert.equal(labels[0].color, COLORS.dimColor, 'other labels stay dim');
}

// An empty scan degrades to an empty plot rather than throwing.
{
    const empty = buildPlotData(null);
    assert.deepEqual(empty.bands, []);
    assert.deepEqual(buildZoneBands([], null), []);
    assert.deepEqual(buildBoundaryGuides([0], null, COLORS.gridColor, COLORS.selectionColor), []);
    assert.deepEqual(buildLayerLabels({ bands: [], totalZ: 1, selected: null, ...COLORS }), []);
}

console.log('PASS needle_plot_zones');
